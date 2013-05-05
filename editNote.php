<?php
require_once("constants.php");
require_once("function.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("notes.php");
require_once("topic.php");

if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}

$topics = Topic::find_all();
$errors = array();
$required_fields = array('title', 'note');



if(isset($_POST['noteId'])){
	$noteId = $_POST['noteId'];     
	$note = Note::find_by_id($noteId);

	echo "<div id=\"registerErrorMessages\"></div>" ;
		echo "<div id=\"registration\">";
			echo "<form action=\"editNote.php\" method=\"post\" id=\"editNoteForm\">" ;
			echo "<legend>Edit Note</legend>" ;
			echo "<input type=\"hidden\" id=\"submit2\" name=\"submit\"/>";
			echo "<input type=\"hidden\" id=\"id\" name=\"id\" value=\"" . $note->id . "\"/> </br>";
			echo "Title:<input type=\"text\" id=\"title\" name=\"title\" value=\"" . $note->title . "\"/> </br>";
			echo "Note:<input type=\"text\" id=\"note\" name=\"note\" value=\"" . $note->note . "\"/> </br>";
			echo "<label for=\"topic_id\">Topic:</label>";
			echo "<select id=\"topic_id\" name=\"topic_id\">";
			foreach($topics as $topic){
				echo "<option value =\"". $topic->id  ."\">" . $topic->topic_title . "</option>";
			}
			echo "</select>";
			echo "<input id=\"editNoteSubmit\" type=\"submit\" name=\"submit\" class=\"btn btn-primary\"/>";
			echo "</form>";	
		echo "</div>";

} else if (isset($_POST['submit'])){

	foreach($required_fields as $required_field){
		if(!(isset($_POST[$required_field])) || (empty($_POST[$required_field]) && is_numeric($_POST[$required_field]))){
			$error[] = $required_field . ' is a required field';
		}
	}

	if(empty($errors)){

		$id = mysql_real_escape_string(htmlspecialchars($_POST['id']));
		$tid = mysql_real_escape_string(htmlspecialchars($_POST['topic_id']));
		$note = mysql_real_escape_string(htmlspecialchars($_POST['note']));
		$title = mysql_real_escape_string(htmlspecialchars($_POST['title']));
		
		$newNote = Note::newNote($tid, $note, $title);
		$newNote->id = $id;
		if($newNote->save()){
			redirect_to("settings.php");
		} else {
			die("Cannot create note." . mysql_error());
		}	
	} else {
		foreach($errors as $error){
			echo $error . '</br></br>' ;
		}
	}
}

?>

<?php
include_once("footer.php");
?>
<script>
	$('#addEditNotesBlock').unbind();
	$('#addEditNotesBlock').on("click","#editNoteSubmit", function(e){

		e.preventDefault();
		e.stopPropagation();

		//alert('21');


		var valid = '';
		var errorDisplay = '' ;
		var required = ' is required.';
		var theTitle = $('form[id="editNoteForm"] #title').val();
		var theNote = $('form[id="editNoteForm"] #note').val();

		if(theTitle == ''){
			valid += '<p>A title is required.</p>' ;
		}
		
		if(theNote == ''){
			valid += '<p>The note is required.</p>' ;
		}

		if(valid.length > 0){
			$('div[class="alert alert-error"]').remove();
					$('div[class="alert alert-success"]').remove();
			errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
			$("#registerErrorMessages").append(errorDisplay);
		} else {
			editNoteFormData = $('form[id="editNoteForm"]').serialize();
			alert(editNoteFormData);
			submitNoteEditData(editNoteFormData);
		}
	});

	function submitNoteEditData(formData){
		$.ajax({
			type:'POST',
			url: 'editNote.php',
			data:formData,
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
					$('div[class="alert alert-success"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">Note has been modified!</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
				$("#settingsControls").load("noteALE.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">The note could not be modified.</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="editRoleForm"]')[0].reset();
			}
		});
	};
</script>