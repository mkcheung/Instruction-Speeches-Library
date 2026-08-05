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



if(isset($_POST['noteId']) && isset($_POST['topicId'])){
	$noteId = $_POST['noteId'];     
	$topicId = $_POST['topicId'];     
	$note = Note::find_by_id($noteId);
?>
	<div id="registerErrorMessages\"></div>
	<form action="editNote.php" method="post" id="editNoteForm">
		<fieldset>
			<legend>Edit Annotations:</legend>
			<input type="hidden" id="id" name="id" value="<?=$note->id?>"/>
			<label for="title">Title:</label>
			<input type="text" id="title" name="title" value="<?=$note->title?>"/>
			<label for="note">Note:</label>
			<textarea row="5" cols="40" id="note" name="note"><?=$note->note?></textarea>

			<label for="begin_time">Begin Time:</label>
			<div class="input-append bootstrap-timepicker">
				<input id='begin_time' name='begin_time' type='text' class='input-small' value="<?=$note->begin_time?>">
				<span class='add-on'><i class='icon-time'></i></span>";
			</div>
			<script type="text/javascript">
				$('#begin_time').timepicker({
					defaultTime:false,
					minuteStep: 1,
					secondStep: 1,
					showSeconds: true,
					showMeridian: false
				});
			</script>
			<label for="end_time">Time Index:</label>
			<div class="input-append bootstrap-timepicker">
				<input id="end_time" name="end_time" type="text" class="input-small" value="<?=$note->end_time?>">
				<span class="add-on"><i class="icon-time"></i></span>
			</div>
			<script type="text/javascript">
				$('#end_time').timepicker({
					defaultTime:false,
					minuteStep: 1,
					secondStep: 1,
					showSeconds: true,
					showMeridian: false
				});
			</script>
			<input type="hidden" id="topic_id" name="topic_id" value="<?=$topicId?>"/>
			<input type="hidden" id="submit2" name="submit"/>
			<div class="row-fluid">
				<div class='span6'>
					<input id="editNoteSubmit" type="submit" name="submit" class="btn btn-primary"/>
					<script>
						$('#editNoteSubmit').click(function(e){

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
								submitNoteEditData(editNoteFormData);
							}
						});
					</script>
				</div>
				<div class='span6'>
					<button id="cancelNoteSubmit" class='btn btn-primary' type='button'>Cancel</button>
					<script>
						$('#cancelNoteSubmit').click(function(e){
							$("#annotationBlock").load('uploadNotes.php');
						});
					</script>
				</div>
			</div>
		</fieldset>
	</form>	
<?php
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
		$beginTime = mysql_real_escape_string(htmlspecialchars($_POST['begin_time']));
		$endTime = mysql_real_escape_string(htmlspecialchars($_POST['end_time']));
		
		$newNote = Note::newNote($tid, $note, $title, $beginTime, $endTime);
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
<script>
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
				$("#notesListingBlock").load('noteListing.php', { 'theTopicId': <?=$topicId?> });
				$('#annotationBlock').load('uploadNotes.php', { 'theTopicId': <?=$topicId?> });
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