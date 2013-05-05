<?php
require_once("constants.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("topic.php");
require_once("notes.php");
require_once("function.php");
include_once("header.php");

if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}
$topics = Topic::find_all();
if(isset($_POST['submit'])){
	$tid = mysql_real_escape_string(htmlspecialchars($_POST['topic_id']));
	$note = mysql_real_escape_string(htmlspecialchars($_POST['note']));
	$title = mysql_real_escape_string(htmlspecialchars($_POST['title']));

	$newNote = Note::newNote($tid, $note, $title);

		if($newNote->save()){
			redirect_to("settings.php");
		} else {
			die("Cannot create note." . mysql_error());
		}	
}

?>

<div class="container">
	<div id="registerErrorMessages"></div>
	<div id="registration">
		<form id="uploadNotesForm" action="uploadNotes.php" method="post">
			<fieldset>
				<legend>New Note:</legend>
				<label for="title">Title:</label>
				<input id="title" name="title"/>
				<label for="note">Note:</label>
				<input id="note" name="note"/>
				<label for="topic_id">Topic:</label>
				<select id="topic_id" name="topic_id">
				<?php
					foreach($topics as $topic){
						echo "<option value =\"". $topic->id  ."\">" . $topic->topic_title . "</option>";
					}
				?>
				</select>
				<input type="hidden" id="submit2" name="submit"/>
				<input id="noteSubmit" type="submit" name="submit" value="submit"/>
			</fieldset>
		</form>
	</div>
</div>


<?php
include_once("footer.php");
?>
<script>
	$('#addEditNotesBlock').unbind();
	$('#addEditNotesBlock').on("click","#noteSubmit", function(e){
		e.preventDefault();
		e.stopPropagation();

		//alert('19');

		var valid = '';
		var errorDisplay = '' ;
		var required = ' is required.';
		var title = $('form[id="uploadNotesForm"] #title').val();
		var note = $('form[id="uploadNotesForm"] #note').val();

		if(title == ''){
			valid += '<p> Title is required. </p>';
		}

		if(note == ''){
			valid += '<p> A note is required. </p>';
		}

		if(valid.length > 0){
			$('div[class="alert alert-error"]').remove();
					$('div[class="alert alert-success"]').remove();
			errorDisplay = '<div class="alert alert-error">' + valid + '</div>';
			$("#registerErrorMessages").append(errorDisplay);
			$("#registerErrorMessages").removeAttr('style');
			$("#registerErrorMessages").fadeOut(2000);
		} else {
			noteFormData = $('form[id="uploadNotesForm"]').serialize();
			submitNoteData(noteFormData);
		}
	});



	function submitNoteData(formData){
		$.ajax({
			type:'POST',
			url: 'uploadNotes.php',
			data:formData,
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
					$('div[class="alert alert-success"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">Note added!</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
				$("#settingsControls").load("noteALE.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">The note could not be added.</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="uploadNotesForm"]')[0].reset();
			}
		});
	};

</script>